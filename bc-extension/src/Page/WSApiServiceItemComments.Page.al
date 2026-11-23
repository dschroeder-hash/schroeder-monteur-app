/// <summary>
/// Remarks on service items / machines (Service Comment Line, Table Name "Service Item") – read only.
/// </summary>
page 50119 "WS API Service Item Comments"
{
    PageType = API;
    APIPublisher = 'schroeder';
    APIGroup = 'werkstatt';
    APIVersion = 'v1.0';
    EntityName = 'serviceItemComment';
    EntitySetName = 'serviceItemComments';
    EntityCaption = 'Service Item Comment';
    EntitySetCaption = 'Service Item Comments';
    SourceTable = "Service Comment Line";
    SourceTableView = where("Table Name" = const("Service Item"));
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
                field(serviceItemNumber; Rec."No.") { }
                field(type; Rec.Type) { }
                field(lineNumber; Rec."Line No.") { }
                field("date"; Rec.Date) { }
                field(comment; Rec.Comment) { }
                field(lastModifiedDateTime; Rec.SystemModifiedAt) { }
            }
        }
    }
}
