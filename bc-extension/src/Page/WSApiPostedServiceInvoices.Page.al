/// <summary>
/// Posted Service Invoices (read-only).
/// </summary>
page 50115 "WS API Posted Service Invoices"
{
    PageType = API;
    APIPublisher = 'schroeder';
    APIGroup = 'werkstatt';
    APIVersion = 'v1.0';
    EntityName = 'postedServiceInvoice';
    EntitySetName = 'postedServiceInvoices';
    EntityCaption = 'postedServiceInvoice';
    EntitySetCaption = 'postedServiceInvoices';
    SourceTable = "Service Invoice Header";
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
                field(orderNumber; Rec."Order No.") { }
                field(postingDate; Rec."Posting Date") { }
                field(customerNumber; Rec."Customer No.") { }
                field(lastModifiedDateTime; Rec.SystemModifiedAt) { }
            }
        }
    }
}
