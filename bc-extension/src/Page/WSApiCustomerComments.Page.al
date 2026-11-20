/// <summary>
/// Remarks on customers (Comment Line, Table Name Customer) – read only. Shown to the Monteur at the order.
/// </summary>
page 50118 "WS API Customer Comments"
{
    PageType = API;
    APIPublisher = 'schroeder';
    APIGroup = 'werkstatt';
    APIVersion = 'v1.0';
    EntityName = 'customerComment';
    EntitySetName = 'customerComments';
    EntityCaption = 'Customer Comment';
    EntitySetCaption = 'Customer Comments';
    SourceTable = "Comment Line";
    SourceTableView = where("Table Name" = const(Customer));
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
                field(customerNumber; Rec."No.") { }
                field(lineNumber; Rec."Line No.") { }
                field("date"; Rec.Date) { }
                field(comment; Rec.Comment) { }
                field(lastModifiedDateTime; Rec.SystemModifiedAt) { }
            }
        }
    }
}
