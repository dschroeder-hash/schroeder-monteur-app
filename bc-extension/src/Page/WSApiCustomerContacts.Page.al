/// <summary>
/// Contact persons of customers: contacts of type Person whose company contact is linked to a customer
/// (Contact Business Relation, Link to Table = Customer). Read only; customerNumber is empty for persons of
/// companies that are not customers (the app ignores them).
/// </summary>
page 50120 "WS API Customer Contacts"
{
    PageType = API;
    APIPublisher = 'schroeder';
    APIGroup = 'werkstatt';
    APIVersion = 'v1.0';
    EntityName = 'customerContact';
    EntitySetName = 'customerContacts';
    EntityCaption = 'Customer Contact';
    EntitySetCaption = 'Customer Contacts';
    SourceTable = Contact;
    SourceTableView = where(Type = const(Person));
    ODataKeyFields = SystemId;
    Editable = false;
    InsertAllowed = false;
    ModifyAllowed = false;
    DeleteAllowed = false;
    Extensible = false;

    layout
    {
        area(Content)
        {
            repeater(Records)
            {
                field(id; Rec.SystemId) { }
                field(number; Rec."No.") { }
                field(customerNumber; CustomerNo) { }
                field(name; Rec.Name) { }
                field(jobTitle; Rec."Job Title") { }
                field(phoneNumber; Rec."Phone No.") { }
                field(mobilePhoneNumber; Rec."Mobile Phone No.") { }
                field(email; Rec."E-Mail") { }
                field(lastModifiedDateTime; Rec.SystemModifiedAt) { }
            }
        }
    }

    var
        CustomerNo: Code[20];

    trigger OnAfterGetRecord()
    var
        ContBusRel: Record "Contact Business Relation";
    begin
        CustomerNo := '';
        ContBusRel.SetRange("Contact No.", Rec."Company No.");
        ContBusRel.SetRange("Link to Table", ContBusRel."Link to Table"::Customer);
        if ContBusRel.FindFirst() then
            CustomerNo := ContBusRel."No.";
    end;
}
